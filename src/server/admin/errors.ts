/** An expected admin failure. The message is safe to show to the admin who made the request. */
export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminError";
  }
}
