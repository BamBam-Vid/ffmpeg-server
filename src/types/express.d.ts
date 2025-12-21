// Extend Express types to include our custom res.locals properties
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare namespace Express {
  interface Locals {
    requestId: string;
  }
}

export {};
