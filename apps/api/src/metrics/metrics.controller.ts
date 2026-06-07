import { Controller, Get, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('metrics')
export class MetricsController {
  constructor(private service: MetricsService) {}
  @Get('dashboard') dashboard(@CurrentUser() userId: string, @Query('domain') domain?: string) {
    return this.service.dashboard(userId, new Date(), domain);
  }

  @Get('heatmap') heatmap(@CurrentUser() userId: string, @Query('days') days?: string) {
    const n = days ? Math.min(366, Math.max(1, Number.parseInt(days, 10) || 182)) : 182;
    return this.service.heatmap(userId, new Date(), n);
  }
}
