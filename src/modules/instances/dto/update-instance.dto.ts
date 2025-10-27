import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';

export class UpdateInstanceDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  sshPort?: number;

  @IsString()
  @IsOptional()
  sshUser?: string;

  @IsString()
  @IsOptional()
  sshKey?: string;

  @IsString()
  @IsOptional()
  sshPassword?: string;
}
