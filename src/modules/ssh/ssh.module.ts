import { Module } from '@nestjs/common';
import { SshService } from './ssh.service';

@Module({
  providers: [SshService],
  exports: [SshService],
})
export class SshModule {}
