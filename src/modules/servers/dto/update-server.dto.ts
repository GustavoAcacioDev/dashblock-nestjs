import { IsString, IsInt, Min, Max, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateServerDto {
  @ApiPropertyOptional({
    description: 'Server display name',
    example: 'My Survival Server',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Server description',
    example: 'A vanilla survival server for friends',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Allocated RAM in megabytes',
    minimum: 512,
    maximum: 32768,
    example: 2048,
  })
  @IsOptional()
  @IsInt()
  @Min(512)
  @Max(32768)
  allocatedRamMb?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of players',
    minimum: 1,
    maximum: 1000,
    example: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxPlayers?: number;
}
