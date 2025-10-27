import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsNotEmpty,
  MinLength,
} from 'class-validator';

export class CreateInstanceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  @IsString()
  @IsNotEmpty()
  ipAddress: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  sshPort?: number = 22;

  @IsString()
  @IsNotEmpty()
  sshUser: string;

  @IsString()
  @IsOptional()
  sshKey?: string; // Base64 encoded or raw SSH private key

  @IsString()
  @IsOptional()
  sshPassword?: string; // Fallback if no SSH key provided
}
