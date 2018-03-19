import * as Koa from 'koa';
import * as Router from 'koa-router';

export class KoaAdapter {
  private static routerInstance: Router

  public static create(): any {
    return new Koa();
  }

  public static createRouter(): any {
    return new Router();
  }
}
