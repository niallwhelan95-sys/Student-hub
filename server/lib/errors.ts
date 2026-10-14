/** An error that is safe to show to the user; carries an HTTP status. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "error",
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new AppError(404, `${what} not found`, "not_found");
export const badRequest = (message: string) => new AppError(400, message, "bad_request");
export const unauthorized = () => new AppError(401, "Please sign in", "unauthorized");
export const forbidden = (message = "Not allowed") => new AppError(403, message, "forbidden");
export const tooMany = () => new AppError(429, "Too many requests — slow down and try again shortly", "rate_limited");
