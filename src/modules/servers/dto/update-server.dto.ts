import { IsString, IsInt, Min, Max, IsOptional } from 'class-validator';

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(512)
  @Max(32768)
  allocatedRamMb?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxPlayers?: number;
}
