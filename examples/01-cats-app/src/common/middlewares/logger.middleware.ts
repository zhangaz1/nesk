import { Middleware, NeskMiddleware, KoaMiddleware } from '@neskjs/common';

@Middleware()
export class LoggerMiddleware implements NeskMiddleware {
  resolve(name: string): KoaMiddleware {
    return async (ctx, next) => {
      console.log(`[${name}] Request...`); // [ApplicationModule] Request...
      await next();
    };
  }
}
