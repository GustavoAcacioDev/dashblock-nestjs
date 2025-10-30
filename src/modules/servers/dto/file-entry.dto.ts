import { ApiProperty } from '@nestjs/swagger';

export class FileEntryDto {
  @ApiProperty({
    description: 'File or directory name',
    example: 'MyMod-1.0.jar',
  })
  name: string;

  @ApiProperty({
    description: 'Whether this entry is a directory',
    example: false,
  })
  is_directory: boolean;

  @ApiProperty({
    description: 'Unix permissions string',
    example: '-rw-r--r--',
  })
  permissions: string;

  @ApiProperty({
    description: 'File size in bytes (0 for directories)',
    example: 1048576,
    required: false,
  })
  size?: number;

  @ApiProperty({
    description: 'Last modified date',
    example: 'Oct 29 12:00',
    required: false,
  })
  modified?: string;
}

export class FileBrowserResponseDto {
  @ApiProperty({
    description: 'Current absolute path',
    example: '/home/opc/minecraft/mc-server-xxxx/mods',
  })
  current_path: string;

  @ApiProperty({
    description: 'List of files and directories',
    type: [FileEntryDto],
  })
  entries: FileEntryDto[];
}
