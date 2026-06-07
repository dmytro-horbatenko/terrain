import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { ExportGeneratorService } from './export-generator.service';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [MetricsModule],
  providers: [ExportGeneratorService, SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
