import { ApiResponse, ApiResponseList } from '../interfaces/api-response.interface';

export class ResponseHelper {
  static success<T>(
    value: T,
    warnings?: string[],
  ): ApiResponse<T> {
    return {
      isSuccess: true,
      value,
      hasWarnings: warnings,
      hasErrors: [],
    };
  }

  static error<T>(
    errors: string[],
    value?: T,
    warnings?: string[],
  ): ApiResponse<T> {
    return {
      isSuccess: false,
      value: value || ({} as T),
      hasWarnings: warnings,
      hasErrors: errors,
    };
  }

  static successList<T>(
    items: T[],
    warnings?: string[],
  ): ApiResponseList<T> {
    return {
      isSuccess: true,
      items,
      hasWarnings: warnings,
      hasErrors: [],
    };
  }

  static errorList<T>(
    errors: string[],
    items?: T[],
    warnings?: string[],
  ): ApiResponseList<T> {
    return {
      isSuccess: false,
      items: items || [],
      hasWarnings: warnings,
      hasErrors: errors,
    };
  }
}
