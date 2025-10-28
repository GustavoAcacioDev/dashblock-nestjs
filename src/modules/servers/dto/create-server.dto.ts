import { IsString, IsEnum, IsInt, Min, Max, IsOptional } from 'class-validator';
import { ServerType } from '@prisma/client';

export class CreateServerDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  version: string; // e.g., "1.20.1"

  @IsEnum(ServerType)
  type: ServerType;

  @IsInt()
  @Min(512)
  @Max(32768)
  allocatedRamMb: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxPlayers?: number;
}
