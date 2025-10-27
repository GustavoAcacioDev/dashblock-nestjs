import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // If a specific field is requested, return that field
    if (data) {
      return user?.[data];
    }

    // Otherwise return the whole user object
    return user;
  },
);
