import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { TopicsModule } from './topics/topics.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PromptsModule } from './prompts/prompts.module';
import { MetricsModule } from './metrics/metrics.module';
import { StreakModule } from './streak/streak.module';
import { SessionsModule } from './sessions/sessions.module';
import { ImportModule } from './import/import.module';
import { TopicTypesModule } from './topic-types/topic-types.module';
import { SettingsModule } from './settings/settings.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    // Baseline DoS/brute-force guard applied to every route (OWASP REST
    // Security Cheat Sheet). Individual endpoints (auth register/login) tighten
    // this further with a per-route @Throttle().
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    TopicsModule,
    ReviewsModule,
    PromptsModule,
    MetricsModule,
    StreakModule,
    SessionsModule,
    ImportModule,
    TopicTypesModule,
    SettingsModule,
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
