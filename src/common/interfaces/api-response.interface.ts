export interface ApiResponse<T> {
  isSuccess: boolean;
  value: T;
  hasWarnings?: string[];
  hasErrors?: string[];
}

export interface ApiResponseList<T> {
  isSuccess: boolean;
  items: T[];
  hasWarnings?: string[];
  hasErrors?: string[];
}
