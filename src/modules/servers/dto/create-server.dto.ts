import { IsString, IsEnum, IsInt, Min, Max, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServerType } from '@prisma/client';

export class CreateServerDto {
  @ApiProperty({
    description: 'Server display name',
    example: 'My Survival Server',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Server description',
    example: 'A vanilla survival server for friends',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Minecraft version',
    example: '1.20.1',
    examples: ['1.20.1', '1.20.2', '1.20.4', '1.21', '1.21.1'],
  })
  @IsString()
  version: string;

  @ApiProperty({
    description: 'Server type/software',
    enum: ServerType,
    example: 'PAPER',
    examples: ['VANILLA', 'PAPER', 'FABRIC', 'PURPUR'],
  })
  @IsEnum(ServerType)
  type: ServerType;

  @ApiProperty({
    description: 'Allocated RAM in megabytes',
    minimum: 512,
    maximum: 32768,
    example: 2048,
  })
  @IsInt()
  @Min(512)
  @Max(32768)
  allocatedRamMb: number;

  @ApiPropertyOptional({
    description: 'Maximum number of players',
    minimum: 1,
    maximum: 1000,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxPlayers?: number;
}
