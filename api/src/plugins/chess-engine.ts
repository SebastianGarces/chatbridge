import { Chess } from "chess.js";

// In-memory game state per conversation
// In production, this would be persisted to DB
const games = new Map<string, Chess>();

export function getOrCreateGame(conversationId: string): Chess {
  if (!games.has(conversationId)) {
    games.set(conversationId, new Chess());
  }
  return games.get(conversationId)!;
}

export function syncGameFromFen(conversationId: string, fen: string): Chess {
  const game = new Chess(fen);
  games.set(conversationId, game);
  return game;
}

export function resetGame(conversationId: string, fen?: string): Chess {
  const game = fen ? new Chess(fen) : new Chess();
  games.set(conversationId, game);
  return game;
}

export function getGameState(game: Chess) {
  return {
    fen: game.fen(),
    turn: game.turn() === "w" ? "white" : "black",
    moveHistory: game.history(),
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isStalemate: game.isStalemate(),
    isDraw: game.isDraw(),
    isGameOver: game.isGameOver(),
  };
}
