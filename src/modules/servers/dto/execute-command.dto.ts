import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExecuteCommandDto {
  @ApiProperty({
    description: 'Minecraft server command to execute via RCON',
    example: 'list',
    examples: [
      'list',
      'say Hello players!',
      'weather clear',
      'time set day',
      'give @a minecraft:diamond 1',
      'gamemode survival @a',
    ],
  })
  @IsString()
  @IsNotEmpty()
  command: string;
}
