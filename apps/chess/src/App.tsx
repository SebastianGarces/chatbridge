import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";

// Inline ChatBridge SDK (avoid cross-project dependency for now)
type ToolHandler = (
  params: Record<string, unknown>
) => unknown | Promise<unknown>;

class ChatBridgeApp {
  private handlers = new Map<string, ToolHandler>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    window.addEventListener("message", this.handleMessage.bind(this));
    this.heartbeatInterval = setInterval(() => {
      window.parent.postMessage({ type: "heartbeat" }, "*");
    }, 5000);
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
          window.parent.postMessage(
            { type: "tool:result", id: data.id, result },
            "*"
          );
        } catch (e: any) {
          window.parent.postMessage(
            {
              type: "tool:result",
              id: data.id,
              result: { error: e.message },
            },
            "*"
          );
        }
      }
    }
  }
}

// ─── Chess App ─────────────────────────────────────────────────────

function App() {
  const [game, setGame] = useState(new Chess());
  const [boardOrientation, setBoardOrientation] = useState<
    "white" | "black"
  >("white");
  const [gameStarted, setGameStarted] = useState(false);
  const [status, setStatus] = useState("Waiting to start...");
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const appRef = useRef<ChatBridgeApp | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(400);

  // Use a ref so tool handlers always access the current game instance
  const gameRef = useRef(game);
  gameRef.current = game;

  const getGameState = useCallback(() => {
    const g = gameRef.current;
    return {
      fen: g.fen(),
      turn: g.turn() === "w" ? "white" : "black",
      moveHistory: g.history(),
      isCheck: g.isCheck(),
      isCheckmate: g.isCheckmate(),
      isStalemate: g.isStalemate(),
      isDraw: g.isDraw(),
      isGameOver: g.isGameOver(),
    };
  }, []);

  const syncState = useCallback(() => {
    if (appRef.current) {
      appRef.current.updateState(getGameState());
    }
  }, [getGameState]);

  // Force re-render by creating a shallow clone of the game object
  const forceGameUpdate = useCallback((g: Chess) => {
    setGame(Object.assign(Object.create(Object.getPrototypeOf(g)), g));
  }, []);

  useEffect(() => {
    const app = new ChatBridgeApp();
    appRef.current = app;

    app.onToolInvoke("start_game", (params) => {
      const color =
        (params.playerColor as string) || "white";
      const newGame = new Chess();
      gameRef.current = newGame;
      setGame(newGame);
      setBoardOrientation(color as "white" | "black");
      setGameStarted(true);
      setStatus(`Game started! You play as ${color}.`);
      setMoveHistory([]);
      return {
        fen: newGame.fen(),
        turn: "white",
        message: `New game started. Player is ${color}.`,
        moveHistory: [],
      };
    });

    app.onToolInvoke("make_move", (params) => {
      const g = gameRef.current;
      const move = params.move as string;
      if (!move) return { error: "No move specified" };
      try {
        const result = g.move(move);
        if (!result) return { error: `Invalid move: ${move}` };
        forceGameUpdate(g);
        setMoveHistory((prev) => [...prev, result.san]);

        const state = {
          fen: g.fen(),
          turn: g.turn() === "w" ? "white" : "black",
          lastMove: result.san,
          moveHistory: g.history(),
          isCheck: g.isCheck(),
          isCheckmate: g.isCheckmate(),
          isGameOver: g.isGameOver(),
        };

        if (g.isCheckmate()) {
          const winner = g.turn() === "w" ? "Black" : "White";
          setStatus(`Checkmate! ${winner} wins!`);
          app.complete(`Checkmate! ${winner} wins after ${g.history().length} moves.`);
        } else if (g.isDraw()) {
          setStatus("Game drawn!");
          app.complete(`Game drawn after ${g.history().length} moves.`);
        } else if (g.isCheck()) {
          setStatus(`Check! ${state.turn}'s turn.`);
        } else {
          setStatus(`${state.turn}'s turn.`);
        }

        // Sync state to parent so AppPanel context stays updated
        app.updateState({
          ...state,
          isStalemate: g.isStalemate(),
          isDraw: g.isDraw(),
        });

        return state;
      } catch (e: any) {
        return { error: e.message || `Invalid move: ${move}` };
      }
    });

    app.onToolInvoke("get_board_state", () => {
      return getGameState();
    });

    app.onToolInvoke("get_legal_moves", () => {
      const g = gameRef.current;
      return {
        moves: g.moves(),
        movesVerbose: g.moves({ verbose: true }).map((m) => ({
          from: m.from,
          to: m.to,
          san: m.san,
          piece: m.piece,
        })),
      };
    });

    // Send resize message after rendering
    const sendResize = () => {
      const h = document.documentElement.scrollHeight;
      window.parent.postMessage({ type: "ui:resize", height: h }, "*");
    };
    // Resize periodically until stable
    const resizeInterval = setInterval(sendResize, 500);
    setTimeout(() => clearInterval(resizeInterval), 5000);

    app.onToolInvoke("resign", () => {
      const g = gameRef.current;
      const winner = g.turn() === "w" ? "Black" : "White";
      setStatus(`${g.turn() === "w" ? "White" : "Black"} resigned. ${winner} wins!`);
      app.complete(
        `${g.turn() === "w" ? "White" : "Black"} resigned after ${g.history().length} moves. ${winner} wins.`
      );
      return { resigned: true, winner };
    });
  }, []);

  // Handle user making a move on the board
  function onDrop(sourceSquare: Square, targetSquare: Square): boolean {
    try {
      const move = game.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });
      if (!move) return false;

      // Force re-render
      forceGameUpdate(game);
      setMoveHistory((prev) => [...prev, move.san]);

      const turn = game.turn() === "w" ? "white" : "black";
      if (game.isCheckmate()) {
        const winner = game.turn() === "w" ? "Black" : "White";
        setStatus(`Checkmate! ${winner} wins!`);
        appRef.current?.complete(
          `Checkmate! ${winner} wins after ${game.history().length} moves.`
        );
      } else if (game.isDraw()) {
        setStatus("Game drawn!");
        appRef.current?.complete(
          `Game drawn after ${game.history().length} moves.`
        );
      } else if (game.isCheck()) {
        setStatus(`Check! ${turn}'s turn.`);
      } else {
        setStatus(`${turn}'s turn.`);
      }

      syncState();
      return true;
    } catch {
      return false;
    }
  }

  // Responsive board sizing
  useLayoutEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth - 32; // padding
        setBoardWidth(Math.min(w, 500));
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Send resize to parent after render
  useEffect(() => {
    const h = document.documentElement.scrollHeight;
    window.parent.postMessage({ type: "ui:resize", height: h }, "*");
  });

  return (
    <div ref={containerRef} style={{ padding: 16, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>Chess</strong>
        <span style={{ fontSize: 12, color: "#666" }}>{status}</span>
      </div>

      <Chessboard
        position={game.fen()}
        onPieceDrop={onDrop}
        boardOrientation={boardOrientation}
        boardWidth={boardWidth}
        customBoardStyle={{
          borderRadius: "4px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
        }}
      />

      {moveHistory.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#888" }}>
          <strong>Moves:</strong>{" "}
          {moveHistory
            .map((m, i) =>
              i % 2 === 0
                ? `${Math.floor(i / 2) + 1}. ${m}`
                : m
            )
            .join(" ")}
        </div>
      )}
    </div>
  );
}

export default App;
