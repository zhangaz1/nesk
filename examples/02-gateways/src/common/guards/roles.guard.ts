import { Guard, CanActivate, ExecutionContext } from '@neskjs/common';
import { Observable } from 'rxjs/Observable';
import { Reflector } from '@neskjs/core';

@Guard()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(data, context: ExecutionContext): boolean {
    const { parent, handler } = context;
    const roles = this.reflector.get<string[]>('roles', handler);
    if (!roles) {
      return true;
    }

    const user = data.user;
    const hasRole = () =>
      !!user.roles.find(role => !!roles.find(item => item === role));
    return user && user.roles && hasRole();
  }
}
