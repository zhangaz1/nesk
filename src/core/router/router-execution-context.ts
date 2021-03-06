import 'reflect-metadata';
import {
  ROUTE_ARGS_METADATA,
  PARAMTYPES_METADATA,
  HTTP_CODE_METADATA,
  CUSTOM_ROUTE_AGRS_METADATA,
  RENDER_METADATA,
} from '@neskjs/common/constants';
import {
  isUndefined,
  isFunction,
  isString,
} from '@neskjs/common/utils/shared.utils';
import { RouteParamtypes } from '@neskjs/common/enums/route-paramtypes.enum';
import { Controller, Transform } from '@neskjs/common/interfaces';
import { RouteParamsMetadata } from '@neskjs/common/decorators';
import { IRouteParamsFactory } from './interfaces/route-params-factory.interface';
import { PipesContextCreator } from './../pipes/pipes-context-creator';
import { PipesConsumer } from './../pipes/pipes-consumer';
import {
  ParamData,
  PipeTransform,
  HttpStatus,
  RequestMethod,
  HttpException,
} from '@neskjs/common';
import { GuardsContextCreator } from '../guards/guards-context-creator';
import { GuardsConsumer } from '../guards/guards-consumer';
import { FORBIDDEN_MESSAGE } from '../guards/constants';
import { RouterResponseController } from './router-response-controller';
import { InterceptorsContextCreator } from '../interceptors/interceptors-context-creator';
import { InterceptorsConsumer } from '../interceptors/interceptors-consumer';

export interface ParamProperties {
  index: number;
  type: RouteParamtypes | string;
  data: ParamData;
  pipes: PipeTransform<any>[];
  extractValue: (ctx, next) => any;
}

export class RouterExecutionContext {
  private readonly responseController = new RouterResponseController();
  constructor(
    private readonly paramsFactory: IRouteParamsFactory,
    private readonly pipesContextCreator: PipesContextCreator,
    private readonly pipesConsumer: PipesConsumer,
    private readonly guardsContextCreator: GuardsContextCreator,
    private readonly guardsConsumer: GuardsConsumer,
    private readonly interceptorsContextCreator: InterceptorsContextCreator,
    private readonly interceptorsConsumer: InterceptorsConsumer,
  ) {}

  public create(
    instance: Controller,
    callback: (...args) => any,
    methodName: string,
    module: string,
    requestMethod: RequestMethod,
  ) {
    const metadata = this.reflectCallbackMetadata(instance, methodName) || {};
    const keys = Object.keys(metadata);
    const argsLength = this.getArgumentsLength(keys, metadata);
    const pipes = this.pipesContextCreator.create(instance, callback);
    const paramtypes = this.reflectCallbackParamtypes(instance, methodName);
    const guards = this.guardsContextCreator.create(instance, callback, module);
    const interceptors = this.interceptorsContextCreator.create(
      instance,
      callback,
      module,
    );
    const httpCode = this.reflectHttpStatusCode(callback);
    const paramsMetadata = this.exchangeKeysForValues(keys, metadata);
    const isResponseHandled = paramsMetadata.some(
      ({ type }) =>
        type === RouteParamtypes.RESPONSE || type === RouteParamtypes.NEXT,
    );
    const paramsOptions = this.mergeParamsMetatypes(paramsMetadata, paramtypes);
    const httpStatusCode = httpCode
      ? httpCode
      : this.responseController.getStatusByMethod(requestMethod);

    const fnCanActivate = this.createGuardsFn(guards, instance, callback);
    const fnApplyPipes = this.createPipesFn(pipes, paramsOptions);
    const fnHandleResponse = this.createHandleResponseFn(
      callback,
      isResponseHandled,
      httpStatusCode,
    );

    return async (ctx, next) => {
      const args = this.createNullArray(argsLength);
      fnCanActivate && (await fnCanActivate(ctx));

      const handler = async () => {
        fnApplyPipes && (await fnApplyPipes(args, ctx, next));
        return callback.apply(instance, args);
      };

      const result = await this.interceptorsConsumer.intercept(
        interceptors,
        ctx,
        instance,
        callback,
        handler,
      );
      await fnHandleResponse(result, ctx);
    };
  }

  public mapParamType(key: string): string {
    const keyPair = key.split(':');
    return keyPair[0];
  }

  public reflectCallbackMetadata(
    instance: Controller,
    methodName: string,
  ): RouteParamsMetadata {
    return Reflect.getMetadata(ROUTE_ARGS_METADATA, instance, methodName);
  }

  public reflectCallbackParamtypes(
    instance: Controller,
    methodName: string,
  ): any[] {
    return Reflect.getMetadata(PARAMTYPES_METADATA, instance, methodName);
  }

  public reflectHttpStatusCode(callback: (...args) => any): number {
    return Reflect.getMetadata(HTTP_CODE_METADATA, callback);
  }

  public reflectRenderTemplate(callback): boolean {
    return Reflect.getMetadata(RENDER_METADATA, callback);
  }

  public getArgumentsLength(
    keys: string[],
    metadata: RouteParamsMetadata,
  ): number {
    return Math.max(...keys.map(key => metadata[key].index)) + 1;
  }

  public createNullArray(length: number): any[] {
    return Array.apply(null, { length }).fill(null);
  }

  public exchangeKeysForValues(
    keys: string[],
    metadata: RouteParamsMetadata,
  ): ParamProperties[] {
    return keys.map(key => {
      const { index, data, pipes } = metadata[key];
      const type = this.mapParamType(key);

      if (key.includes(CUSTOM_ROUTE_AGRS_METADATA)) {
        const { factory } = metadata[key];
        const customExtractValue = this.getCustomFactory(factory, data);
        return { index, extractValue: customExtractValue, type, data, pipes };
      }
      const nType = Number(type);
      const extractValue = (ctx, next) =>
        this.paramsFactory.exchangeKeyForValue(nType, data, { ctx, next });
      return { index, extractValue, type: nType, data, pipes };
    });
  }

  public getCustomFactory(factory: (...args) => void, data): (...args) => any {
    return !isUndefined(factory) && isFunction(factory)
      ? (ctx, next) => factory(data, ctx.request)
      : () => null;
  }

  public mergeParamsMetatypes(
    paramsProperties: ParamProperties[],
    paramtypes: any[],
  ): (ParamProperties & { metatype?: any })[] {
    if (!paramtypes) {
      return paramsProperties;
    }
    return paramsProperties.map(param => ({
      ...param,
      metatype: paramtypes[param.index],
    }));
  }

  public async getParamValue<T>(
    value: T,
    { metatype, type, data },
    transforms: Transform<any>[],
  ): Promise<any> {
    if (
      type === RouteParamtypes.BODY ||
      type === RouteParamtypes.QUERY ||
      type === RouteParamtypes.PARAM ||
      isString(type)
    ) {
      return await this.pipesConsumer.apply(
        value,
        { metatype, type, data },
        transforms,
      );
    }
    return Promise.resolve(value);
  }

  public createGuardsFn(
    guards: any[],
    instance: Controller,
    callback: (...args) => any,
  ) {
    const canActivateFn = async context => {
      const canActivate = await this.guardsConsumer.tryActivate(
        guards,
        context,
        instance,
        callback,
      );
      if (!canActivate) {
        throw new HttpException(FORBIDDEN_MESSAGE, HttpStatus.FORBIDDEN);
      }
    };
    return guards.length ? canActivateFn : null;
  }

  public createPipesFn(
    pipes: any[],
    paramsOptions: (ParamProperties & { metatype?: any })[],
  ) {
    const pipesFn = async (args, ctx, next) => {
      await Promise.all(
        paramsOptions.map(async param => {
          const {
            index,
            extractValue,
            type,
            data,
            metatype,
            pipes: paramPipes,
          } = param;
          const value = extractValue(ctx, next);
          
          args[index] = await this.getParamValue(
            value,
            { metatype, type, data },
            pipes.concat(
              this.pipesContextCreator.createConcreteContext(paramPipes),
            ),
          );
        }),
      );
    };
    return paramsOptions.length ? pipesFn : null;
  }

  public createHandleResponseFn(
    callback,
    isResponseHandled: boolean,
    httpStatusCode: number,
  ) {
    const renderTemplate = this.reflectRenderTemplate(callback);
    if (!!renderTemplate) {
      return async (result, ctx) => await ctx.render(renderTemplate, result);
    }
    
    return async (result, ctx) =>
      !isResponseHandled &&
      (await this.responseController.apply(result, ctx.response, httpStatusCode));
  }
}
