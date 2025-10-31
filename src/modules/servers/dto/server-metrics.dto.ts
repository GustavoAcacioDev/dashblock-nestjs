import { ApiProperty } from '@nestjs/swagger';

export class ServerMetricsDto {
  @ApiProperty({ description: 'CPU usage percentage', example: 45.2 })
  cpuUsage: number;

  @ApiProperty({ description: 'Memory usage in MB', example: 2048 })
  memoryUsedMb: number;

  @ApiProperty({ description: 'Total memory allocated in MB', example: 4096 })
  memoryAllocatedMb: number;

  @ApiProperty({ description: 'Memory usage percentage', example: 50 })
  memoryUsagePercent: number;

  @ApiProperty({ description: 'Disk usage in GB', example: 12.5 })
  diskUsedGb: number;

  @ApiProperty({ description: 'Total disk space in GB', example: 50 })
  diskTotalGb: number;

  @ApiProperty({ description: 'Disk usage percentage', example: 25 })
  diskUsagePercent: number;

  @ApiProperty({ description: 'Uptime in seconds', example: 3600 })
  uptimeSeconds: number;

  @ApiProperty({ description: 'Number of active players', example: 5 })
  activePlayers: number;

  @ApiProperty({ description: 'Max players allowed', example: 20 })
  maxPlayers: number;
}

export class InstanceMetricsDto {
  @ApiProperty({ description: 'Total CPU usage percentage', example: 35.5 })
  cpuUsage: number;

  @ApiProperty({ description: 'Total memory usage in MB', example: 8192 })
  memoryUsedMb: number;

  @ApiProperty({ description: 'Total available memory in MB', example: 16384 })
  memoryTotalMb: number;

  @ApiProperty({ description: 'Memory usage percentage', example: 50 })
  memoryUsagePercent: number;

  @ApiProperty({ description: 'Disk usage in GB', example: 45.2 })
  diskUsedGb: number;

  @ApiProperty({ description: 'Total disk space in GB', example: 100 })
  diskTotalGb: number;

  @ApiProperty({ description: 'Disk usage percentage', example: 45.2 })
  diskUsagePercent: number;

  @ApiProperty({ description: 'Number of running Minecraft servers', example: 3 })
  runningServers: number;

  @ApiProperty({ description: 'System uptime in seconds', example: 86400 })
  uptimeSeconds: number;

  @ApiProperty({ description: 'Load average (1 min)', example: 1.5 })
  loadAverage1m: number;

  @ApiProperty({ description: 'Load average (5 min)', example: 1.2 })
  loadAverage5m: number;

  @ApiProperty({ description: 'Load average (15 min)', example: 0.8 })
  loadAverage15m: number;
}
