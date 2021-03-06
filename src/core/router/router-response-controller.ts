import { RequestMethod, HttpStatus } from '@neskjs/common';
import { isNil, isObject, isFunction } from '@neskjs/common/utils/shared.utils';
import 'rxjs/add/operator/toPromise';

export class RouterResponseController {
  public async apply(resultOrDeffered, response, httpStatusCode: number) {
    const result = await this.transformToResult(resultOrDeffered);
    response.status = httpStatusCode;
    if (isNil(result)) {
      return response.send();
    }
    return isObject(result) ? response.json(result) : response.send(String(result));
  }

  public async render(resultOrDeffered, ctx, template: string) {
    const result = await this.transformToResult(resultOrDeffered);
    ctx.render(template, result);
  }

  public async transformToResult(resultOrDeffered) {
    if (resultOrDeffered instanceof Promise) {
      return await resultOrDeffered;
    } else if (resultOrDeffered && isFunction(resultOrDeffered.subscribe)) {
      return await resultOrDeffered.toPromise();
    }
    return resultOrDeffered;
  }

  public getStatusByMethod(requestMethod: RequestMethod): number {
    switch (requestMethod) {
      case RequestMethod.POST:
        return HttpStatus.CREATED;
      default:
        return HttpStatus.OK;
    }
  }
}
