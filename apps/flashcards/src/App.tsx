import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type RecordLog,
} from "ts-fsrs";

// ─── Types ─────────────────────────────────────────────────────────

interface FlashCard {
  id: string;
  front: string;
  back: string;
  card: Card;
}

interface Deck {
  id: string;
  name: string;
  description?: string;
  cards: FlashCard[];
}

// ─── ChatBridge SDK (inline) ───────────────────────────────────────

type ToolHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

class ChatBridgeApp {
  private handlers = new Map<string, ToolHandler>();

  constructor() {
    window.addEventListener("message", this.handleMessage.bind(this));
    setInterval(() => window.parent.postMessage({ type: "heartbeat" }, "*"), 5000);
    window.parent.postMessage({ type: "app:ready" }, "*");
  }

  onToolInvoke(name: string, handler: ToolHandler) {
    this.handlers.set(name, handler);
  }

  updateState(state: Record<string, unknown>) {
    window.parent.postMessage({ type: "state:update", state }, "*");
  }

  complete(summary: string) {
    window.parent.postMessage({ type: "app:complete", summary }, "*");
  }

  private async handleMessage(event: MessageEvent) {
    const data = event.data;
    if (!data?.type) return;
    if (data.type === "tool:invoke") {
      const handler = this.handlers.get(data.tool);
      if (handler) {
        try {
          const result = await handler(data.params || {});
          window.parent.postMessage({ type: "tool:result", id: data.id, result }, "*");
        } catch (e: any) {
          window.parent.postMessage({ type: "tool:result", id: data.id, result: { error: e.message } }, "*");
        }
      }
    }
  }
}

// ─── FSRS Scheduler ────────────────────────────────────────────────

const params = generatorParameters();
const scheduler = fsrs(params);

function getDueCards(deck: Deck): FlashCard[] {
  const now = new Date();
  return deck.cards.filter((c) => new Date(c.card.due) <= now);
}

// ─── App Component ─────────────────────────────────────────────────

let idCounter = 0;
const genId = () => `card_${++idCounter}`;
const genDeckId = () => `deck_${++idCounter}`;

function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [currentCard, setCurrentCard] = useState<FlashCard | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<FlashCard[]>([]);
  const [sessionStats, setSessionStats] = useState({ total: 0, correct: 0 });
  const appRef = useRef<ChatBridgeApp | null>(null);
  const decksRef = useRef<Deck[]>([]);
  const reviewQueueRef = useRef<FlashCard[]>([]);
  const sessionStatsRef = useRef({ total: 0, correct: 0 });

  const activeDeck = decks.find((d) => d.id === activeDeckId) || null;

  useEffect(() => { decksRef.current = decks; }, [decks]);
  useEffect(() => { reviewQueueRef.current = reviewQueue; }, [reviewQueue]);
  useEffect(() => { sessionStatsRef.current = sessionStats; }, [sessionStats]);

  const syncState = useCallback(() => {
    appRef.current?.updateState({
      activeDeck: activeDeck?.name || null,
      currentCard: currentCard ? { front: currentCard.front, isFlipped } : null,
      cardsRemaining: reviewQueue.length,
      sessionStats,
    });
  }, [activeDeck, currentCard, isFlipped, reviewQueue, sessionStats]);

  useEffect(() => {
    const app = new ChatBridgeApp();
    appRef.current = app;

    app.onToolInvoke("create_deck", (params) => {
      const name = params.name as string;
      const description = params.description as string | undefined;
      const deckId = (params.deckId as string) || genDeckId();
      const deck: Deck = {
        id: deckId,
        name,
        description,
        cards: [],
      };
      setDecks((prev) => [...prev, deck]);
      setActiveDeckId(deck.id);
      return { deckId: deck.id, name: deck.name, message: `Deck "${name}" created.` };
    });

    app.onToolInvoke("add_card", (params) => {
      const deckId = params.deckId as string;
      const front = params.front as string;
      const back = params.back as string;
      const card: FlashCard = {
        id: genId(),
        front,
        back,
        card: createEmptyCard(),
      };
      setDecks((prev) =>
        prev.map((d) =>
          d.id === deckId ? { ...d, cards: [...d.cards, card] } : d
        )
      );
      return { cardId: card.id, front, back, message: "Card added." };
    });

    app.onToolInvoke("start_review", (params) => {
      const deckId = params.deckId as string;
      const deck = decksRef.current.find((d) => d.id === deckId);
      if (!deck) return { error: `Deck ${deckId} not found` };
      const due = getDueCards(deck);
      if (due.length === 0) {
        return { message: "No cards due for review!", dueCount: 0 };
      }
      setActiveDeckId(deckId);
      setReviewQueue(due.slice(1));
      setCurrentCard(due[0]);
      setIsFlipped(false);
      setSessionStats({ total: 0, correct: 0 });
      return {
        message: `Review started! ${due.length} cards due.`,
        dueCount: due.length,
        firstCard: { id: due[0].id, front: due[0].front },
      };
    });

    app.onToolInvoke("submit_answer", (params) => {
      const cardId = params.cardId as string;
      const ratingStr = params.rating as string;
      const ratingMap: Record<string, Rating> = {
        again: Rating.Again,
        hard: Rating.Hard,
        good: Rating.Good,
        easy: Rating.Easy,
      };
      const rating = ratingMap[ratingStr];
      if (rating === undefined) return { error: `Invalid rating: ${ratingStr}` };

      // Find and update the card
      let updatedCard: FlashCard | null = null;
      setDecks((prev) =>
        prev.map((d) => ({
          ...d,
          cards: d.cards.map((c) => {
            if (c.id === cardId) {
              const log = scheduler.repeat(c.card, new Date());
              const newCard = log[rating].card;
              updatedCard = { ...c, card: newCard };
              return updatedCard;
            }
            return c;
          }),
        }))
      );

      const isCorrect = ratingStr !== "again";
      setSessionStats((prev) => ({
        total: prev.total + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
      }));

      // Advance to next card
      const queue = reviewQueueRef.current;
      if (queue.length > 0) {
        setCurrentCard(queue[0]);
        setReviewQueue((prev) => prev.slice(1));
        setIsFlipped(false);
        return {
          message: `Rated "${ratingStr}". Next card.`,
          nextCard: { id: queue[0].id, front: queue[0].front },
          remaining: queue.length - 1,
        };
      } else {
        setCurrentCard(null);
        setIsFlipped(false);
        const curStats = sessionStatsRef.current;
        const stats = {
          total: curStats.total + 1,
          correct: curStats.correct + (isCorrect ? 1 : 0),
        };
        app.complete(
          `Review complete! ${stats.correct}/${stats.total} correct.`
        );
        return {
          message: "Review session complete!",
          stats,
          remaining: 0,
        };
      }
    });

    app.onToolInvoke("get_stats", (params) => {
      const deckId = params.deckId as string;
      const deck = decksRef.current.find((d) => d.id === deckId);
      if (!deck) return { error: `Deck ${deckId} not found` };
      const due = getDueCards(deck);
      return {
        deckName: deck.name,
        totalCards: deck.cards.length,
        dueToday: due.length,
        reviewed: sessionStatsRef.current.total,
        correct: sessionStatsRef.current.correct,
      };
    });
  }, []);

  useEffect(() => {
    syncState();
  }, [syncState]);

  // ─── Rating Handlers ─────────────────────────────────────────────

  const handleRate = (rating: string) => {
    if (!currentCard) return;
    // Trigger the submit_answer tool handler directly
    const ratingMap: Record<string, Rating> = {
      again: Rating.Again,
      hard: Rating.Hard,
      good: Rating.Good,
      easy: Rating.Easy,
    };
    const r = ratingMap[rating];
    if (r === undefined) return;

    // Update card via FSRS
    setDecks((prev) =>
      prev.map((d) => ({
        ...d,
        cards: d.cards.map((c) => {
          if (c.id === currentCard.id) {
            const log = scheduler.repeat(c.card, new Date());
            return { ...c, card: log[r].card };
          }
          return c;
        }),
      }))
    );

    const isCorrect = rating !== "again";
    setSessionStats((prev) => ({
      total: prev.total + 1,
      correct: prev.correct + (isCorrect ? 1 : 0),
    }));

    if (reviewQueue.length > 0) {
      setCurrentCard(reviewQueue[0]);
      setReviewQueue((prev) => prev.slice(1));
      setIsFlipped(false);
    } else {
      setCurrentCard(null);
      setIsFlipped(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  if (!activeDeck) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#888" }}>
        <p style={{ fontSize: 14 }}>Waiting for a deck to be created...</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>
          Ask the AI to "make flashcards about" a topic.
        </p>
      </div>
    );
  }

  if (!currentCard) {
    return (
      <div style={{ padding: 16, textAlign: "center" }}>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>{activeDeck.name}</h3>
        <p style={{ fontSize: 14, color: "#666" }}>
          {sessionStats.total > 0
            ? `Session complete! ${sessionStats.correct}/${sessionStats.total} correct.`
            : `${activeDeck.cards.length} cards in deck. Ask the AI to start a review.`}
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, color: "#888" }}>
        <span>{activeDeck.name}</span>
        <span>{reviewQueue.length + 1} remaining</span>
      </div>

      {/* Card */}
      <div
        onClick={() => setIsFlipped(!isFlipped)}
        style={{
          minHeight: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          cursor: "pointer",
          background: isFlipped ? "#f0fdf4" : "#fff",
          transition: "background 0.2s",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 10, color: "#aaa", marginBottom: 8 }}>
            {isFlipped ? "ANSWER" : "QUESTION"} — tap to flip
          </p>
          <p style={{ fontSize: 16, fontWeight: 500 }}>
            {isFlipped ? currentCard.back : currentCard.front}
          </p>
        </div>
      </div>

      {/* Rating buttons */}
      {isFlipped && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {[
            { label: "Again", value: "again", color: "#ef4444" },
            { label: "Hard", value: "hard", color: "#f59e0b" },
            { label: "Good", value: "good", color: "#22c55e" },
            { label: "Easy", value: "easy", color: "#3b82f6" },
          ].map((btn) => (
            <button
              key={btn.value}
              onClick={() => handleRate(btn.value)}
              style={{
                flex: 1,
                padding: "8px 0",
                border: "none",
                borderRadius: 6,
                background: btn.color,
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}

      {/* Progress */}
      <div style={{ marginTop: 8, fontSize: 12, color: "#888", textAlign: "center" }}>
        {sessionStats.total > 0 &&
          `${sessionStats.correct}/${sessionStats.total} correct`}
      </div>
    </div>
  );
}

export default App;
