import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateInstanceDto {
  @ApiPropertyOptional({
    description: 'Instance name',
    example: 'Production Server',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'IP address of the instance',
    example: '192.168.1.100',
  })
  @IsString()
  @IsOptional()
  ipAddress?: string;

  @ApiPropertyOptional({
    description: 'SSH port number',
    minimum: 1,
    maximum: 65535,
    example: 22,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  sshPort?: number;

  @ApiPropertyOptional({
    description: 'SSH username',
    example: 'root',
  })
  @IsString()
  @IsOptional()
  sshUser?: string;

  @ApiPropertyOptional({
    description: 'SSH private key (Base64 encoded or raw)',
    example: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA...\n-----END OPENSSH PRIVATE KEY-----',
  })
  @IsString()
  @IsOptional()
  sshKey?: string;

  @ApiPropertyOptional({
    description: 'SSH password',
    example: 'securePassword123',
  })
  @IsString()
  @IsOptional()
  sshPassword?: string;
}
