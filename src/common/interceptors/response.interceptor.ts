import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse, ApiResponseList } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | ApiResponseList<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T> | ApiResponseList<T>> {
    return next.handle().pipe(
      map((data) => {
        // If data is already in the correct format, return as is
        if (data && ('isSuccess' in data) && ('value' in data || 'items' in data)) {
          return data;
        }

        // If data is an array, wrap in ApiResponseList
        if (Array.isArray(data)) {
          return {
            isSuccess: true,
            items: data,
            hasWarnings: [],
            hasErrors: [],
          };
        }

        // Otherwise, wrap in ApiResponse
        return {
          isSuccess: true,
          value: data,
          hasWarnings: [],
          hasErrors: [],
        };
      }),
    );
  }
}
