import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsNotEmpty,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInstanceDto {
  @ApiProperty({
    description: 'Instance name',
    example: 'Production Server',
    minLength: 3,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  @ApiProperty({
    description: 'IP address of the instance',
    example: '192.168.1.100',
  })
  @IsString()
  @IsNotEmpty()
  ipAddress: string;

  @ApiPropertyOptional({
    description: 'SSH port number',
    minimum: 1,
    maximum: 65535,
    default: 22,
    example: 22,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  sshPort?: number = 22;

  @ApiProperty({
    description: 'SSH username',
    example: 'root',
  })
  @IsString()
  @IsNotEmpty()
  sshUser: string;

  @ApiPropertyOptional({
    description: 'SSH private key (Base64 encoded or raw)',
    example: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA...\n-----END OPENSSH PRIVATE KEY-----',
  })
  @IsString()
  @IsOptional()
  sshKey?: string; // Base64 encoded or raw SSH private key

  @ApiPropertyOptional({
    description: 'SSH password (fallback if no SSH key provided)',
    example: 'securePassword123',
  })
  @IsString()
  @IsOptional()
  sshPassword?: string; // Fallback if no SSH key provided
}
