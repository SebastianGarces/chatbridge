import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
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
  private boundHandler: (e: MessageEvent) => void;
  private heartbeatId: ReturnType<typeof setInterval>;

  constructor() {
    this.boundHandler = this.handleMessage.bind(this);
    window.addEventListener("message", this.boundHandler);
    this.heartbeatId = setInterval(() => window.parent.postMessage({ type: "heartbeat" }, "*"), 5000);
    window.parent.postMessage({ type: "app:ready" }, "*");
  }

  destroy() {
    window.removeEventListener("message", this.boundHandler);
    clearInterval(this.heartbeatId);
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

  private onSessionChange: ((sessionId: string) => void) | null = null;

  onSession(handler: (sessionId: string) => void) {
    this.onSessionChange = handler;
  }

  private async handleMessage(event: MessageEvent) {
    const data = event.data;
    if (!data?.type) return;
    if (data.type === "app:init" && data.sessionId != null) {
      currentSessionId = data.sessionId || "default";
      this.onSessionChange?.(data.sessionId);
      return;
    }
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

// ─── Persistence ──────────────────────────────────────────────────

let currentSessionId: string | null = null;

function storageKey() {
  return currentSessionId
    ? `chatbridge-flashcards-${currentSessionId}`
    : "chatbridge-flashcards-decks";
}

function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveDecks(decks: Deck[]) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(decks));
  } catch { /* ignore */ }
}

// Synchronous data store — tool handlers read/write this immediately so
// back-to-back invocations (create_deck → add_card → start_review) that
// arrive in the same queue drain always see the latest state, without
// waiting for React's async useEffect to update refs.
let syncDecks: Deck[] = loadDecks();
let syncReviewQueue: FlashCard[] = [];
let syncSessionStats = { total: 0, correct: 0 };

function App() {
  const [decks, setDecks] = useState<Deck[]>(syncDecks);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(
    syncDecks.length > 0 ? syncDecks[syncDecks.length - 1].id : null
  );
  const [currentCard, setCurrentCard] = useState<FlashCard | null>(null);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<FlashCard[]>([]);
  const [sessionStats, setSessionStats] = useState({ total: 0, correct: 0 });
  const appRef = useRef<ChatBridgeApp | null>(null);

  const activeDeck = decks.find((d) => d.id === activeDeckId) || null;

  // Start or restart a review for the active deck (bypasses FSRS scheduling — reviews all cards)
  const startReview = useCallback((deck: Deck) => {
    if (deck.cards.length === 0) return;
    const cards = [...deck.cards];
    syncReviewQueue = cards.slice(1);
    syncSessionStats = { total: 0, correct: 0 };
    setReviewQueue([...syncReviewQueue]);
    setCurrentCard(cards[0]);
    setIsFlipped(false);
    setSessionStats({ ...syncSessionStats });
  }, []);

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

    // When session changes (chat switch), reload decks for that session
    app.onSession(() => {
      syncDecks = loadDecks();
      syncReviewQueue = [];
      syncSessionStats = { total: 0, correct: 0 };
      setDecks([...syncDecks]);
      setActiveDeckId(syncDecks.length > 0 ? syncDecks[syncDecks.length - 1].id : null);
      setCurrentCard(null);
      setReviewQueue([]);
      setSessionStats({ ...syncSessionStats });
    });

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
      syncDecks = [...syncDecks, deck];
      saveDecks(syncDecks);
      // Reset review state immediately so the UI switches to the new deck
      syncReviewQueue = [];
      syncSessionStats = { total: 0, correct: 0 };
      setDecks([...syncDecks]);
      setActiveDeckId(deck.id);
      setCurrentCard(null);
      setReviewQueue([]);
      setIsFlipped(false);
      setSessionStats({ ...syncSessionStats });
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
      syncDecks = syncDecks.map((d) =>
        d.id === deckId ? { ...d, cards: [...d.cards, card] } : d
      );
      saveDecks(syncDecks);
      setDecks([...syncDecks]);
      return { cardId: card.id, front, back, message: "Card added." };
    });

    app.onToolInvoke("start_review", (params) => {
      const deckId = params.deckId as string;
      const deck = syncDecks.find((d) => d.id === deckId);
      if (!deck) return { error: `Deck ${deckId} not found` };
      if (deck.cards.length === 0) {
        return { message: "No cards in deck!", cardCount: 0 };
      }
      // Review ALL cards (not just FSRS-due) so restart always works
      const cards = [...deck.cards];
      syncReviewQueue = cards.slice(1);
      syncSessionStats = { total: 0, correct: 0 };
      setActiveDeckId(deckId);
      setReviewQueue([...syncReviewQueue]);
      setCurrentCard(cards[0]);
      setIsFlipped(false);
      setSessionStats({ ...syncSessionStats });
      return {
        message: `Review started! ${cards.length} cards to study.`,
        cardCount: cards.length,
        firstCard: { id: cards[0].id, front: cards[0].front },
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

      // Update the card in sync store
      syncDecks = syncDecks.map((d) => ({
        ...d,
        cards: d.cards.map((c) => {
          if (c.id === cardId) {
            const log = scheduler.repeat(c.card, new Date());
            return { ...c, card: log[rating].card };
          }
          return c;
        }),
      }));
      saveDecks(syncDecks);
      setDecks([...syncDecks]);

      const isCorrect = ratingStr !== "again";
      syncSessionStats = {
        total: syncSessionStats.total + 1,
        correct: syncSessionStats.correct + (isCorrect ? 1 : 0),
      };
      setSessionStats({ ...syncSessionStats });

      // Advance to next card
      if (syncReviewQueue.length > 0) {
        const next = syncReviewQueue[0];
        syncReviewQueue = syncReviewQueue.slice(1);
        setCurrentCard(next);
        setReviewQueue([...syncReviewQueue]);
        setIsFlipped(false);
        return {
          message: `Rated "${ratingStr}". Next card.`,
          nextCard: { id: next.id, front: next.front },
          remaining: syncReviewQueue.length,
        };
      } else {
        setCurrentCard(null);
        setIsFlipped(false);
        app.complete(
          `Review complete! ${syncSessionStats.correct}/${syncSessionStats.total} correct.`
        );
        return {
          message: "Review session complete!",
          stats: { ...syncSessionStats },
          remaining: 0,
        };
      }
    });

    app.onToolInvoke("get_stats", (params) => {
      const deckId = params.deckId as string;
      const deck = syncDecks.find((d) => d.id === deckId);
      if (!deck) return { error: `Deck ${deckId} not found` };
      const due = getDueCards(deck);
      return {
        deckName: deck.name,
        totalCards: deck.cards.length,
        dueToday: due.length,
        reviewed: syncSessionStats.total,
        correct: syncSessionStats.correct,
      };
    });

    return () => {
      app.destroy();
      // Reset transient state for StrictMode remount — decks persist via localStorage
      syncDecks = loadDecks();
      syncReviewQueue = [];
      syncSessionStats = { total: 0, correct: 0 };
    };
  }, []);

  useEffect(() => {
    syncState();
  }, [syncState]);

  // ─── Rating Handlers ─────────────────────────────────────────────

  const handleRate = (rating: string) => {
    if (!currentCard) return;
    const ratingMap: Record<string, Rating> = {
      again: Rating.Again,
      hard: Rating.Hard,
      good: Rating.Good,
      easy: Rating.Easy,
    };
    const r = ratingMap[rating];
    if (r === undefined) return;

    // Update card via FSRS in sync store
    syncDecks = syncDecks.map((d) => ({
      ...d,
      cards: d.cards.map((c) => {
        if (c.id === currentCard.id) {
          const log = scheduler.repeat(c.card, new Date());
          return { ...c, card: log[r].card };
        }
        return c;
      }),
    }));
    saveDecks(syncDecks);
    setDecks([...syncDecks]);

    const isCorrect = rating !== "again";
    syncSessionStats = {
      total: syncSessionStats.total + 1,
      correct: syncSessionStats.correct + (isCorrect ? 1 : 0),
    };
    setSessionStats({ ...syncSessionStats });

    if (syncReviewQueue.length > 0) {
      const next = syncReviewQueue[0];
      syncReviewQueue = syncReviewQueue.slice(1);
      setCurrentCard(next);
      setReviewQueue([...syncReviewQueue]);
      setIsFlipped(false);
    } else {
      setCurrentCard(null);
      setIsFlipped(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  if (!activeDeck) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#aaa", minHeight: "100vh", background: "#1a1a2e", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#128218;</div>
        <p style={{ fontSize: 16, fontWeight: 500, color: "#e0e0e0", margin: "0 0 8px 0" }}>Waiting for a deck to be created...</p>
        <p style={{ fontSize: 13, color: "#888", margin: 0 }}>
          Ask the AI to "make flashcards about" a topic.
        </p>
      </div>
    );
  }

  if (!currentCard) {
    const sessionComplete = sessionStats.total > 0;
    return (
      <div style={{ padding: 24, textAlign: "center", minHeight: "100vh", background: "#1a1a2e", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>
          {sessionComplete ? "\u2705" : "\u{1F4DA}"}
        </div>
        <h3 style={{ fontSize: 18, marginBottom: 8, color: "#e0e0e0", fontWeight: 600 }}>{activeDeck.name}</h3>
        <p style={{ fontSize: 14, color: "#aaa", margin: "0 0 16px 0" }}>
          {sessionComplete
            ? `Session complete! ${sessionStats.correct}/${sessionStats.total} correct.`
            : `${activeDeck.cards.length} cards in deck.`}
        </p>

        {activeDeck.cards.length > 0 && (
          <button
            onClick={() => startReview(activeDeck)}
            style={{
              padding: "12px 32px",
              border: "none",
              borderRadius: 8,
              background: "#6366f1",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            {sessionComplete ? "Review Again" : "Start Review"}
          </button>
        )}

        {/* Deck switcher — show other decks if they exist */}
        {decks.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>Other decks:</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {decks.filter(d => d.id !== activeDeckId).map(d => (
                <button
                  key={d.id}
                  onClick={() => {
                    setActiveDeckId(d.id);
                    setCurrentCard(null);
                    syncSessionStats = { total: 0, correct: 0 };
                    setSessionStats({ ...syncSessionStats });
                  }}
                  style={{
                    padding: "6px 14px",
                    border: "1px solid #444",
                    borderRadius: 6,
                    background: "transparent",
                    color: "#aaa",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {d.name} ({d.cards.length})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#1a1a2e", color: "#e0e0e0" }}>
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
          border: "1px solid #333",
          borderRadius: 12,
          cursor: "pointer",
          background: isFlipped ? "#1b3a2a" : "#252540",
          transition: "background 0.3s",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "#888", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            {isFlipped ? "Answer" : "Question"} — tap to flip
          </p>
          <p style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.5, color: "#f0f0f0" }}>
            {isFlipped ? currentCard.back : currentCard.front}
          </p>
        </div>
      </div>

      {/* Rating buttons */}
      {isFlipped && (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
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
                padding: "10px 0",
                border: "none",
                borderRadius: 8,
                background: btn.color,
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}

      {/* Progress */}
      <div style={{ marginTop: 12, fontSize: 13, color: "#888", textAlign: "center" }}>
        {sessionStats.total > 0 &&
          `${sessionStats.correct}/${sessionStats.total} correct`}
      </div>
    </div>
  );
}

export default App;
