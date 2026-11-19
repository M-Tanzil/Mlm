export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m, d) => new AppError(400, m, d);
export const unauthorized = (m = 'Unauthorized') => new AppError(401, m);
export const forbidden = (m = 'Forbidden') => new AppError(403, m);
export const notFound = (m = 'Not found') => new AppError(404, m);
