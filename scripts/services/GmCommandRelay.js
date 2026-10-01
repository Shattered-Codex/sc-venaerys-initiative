import { SOCKET_NAME } from "../constants/module-constants.js";
import ErrorGuard from "./ErrorGuard.js";

/**
 * Carries a GM command from a GM who is not the active one to the active GM,
 * over the module's native socket. The active GM only accepts commands sent
 * by a GM, for a combat that exists.
 */
export default class GmCommandRelay {
  constructor(run) {
    this.run = run;
  }

  start() {
    game.socket.on(SOCKET_NAME, ErrorGuard.wrap("socket", (message, userId) => this.receive(message, userId)));
  }

  send(message) {
    game.socket.emit(SOCKET_NAME, message);
  }

  receive(message, userId) {
    if (!game.user.isActiveGM) return undefined;
    if (!game.users.get(userId)?.isGM) return undefined;
    if (!message || typeof message.action !== "string" || !game.combats.get(message.combatId)) return undefined;
    return this.run(message.action, message.combatId, message.payload ?? {});
  }
}
