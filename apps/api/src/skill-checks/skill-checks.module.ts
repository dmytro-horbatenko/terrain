import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SkillChecksService } from './skill-checks.service';

@Controller('skill-checks')
export class SkillChecksController {
  constructor(private service: SkillChecksService) {}
  @Get() list(@CurrentUser() userId: string) {
    return this.service.list(userId);
  }
  @Post() create(@CurrentUser() userId: string, @Body() input: unknown) {
    return this.service.create(userId, input);
  }
  @Post(':id/attempt') attempt(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    return this.service.attempt(userId, id, input);
  }
  @Post(':id/result') assess(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    return this.service.assess(userId, id, input);
  }
  @Post(':id/cancel') cancel(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(userId, id);
  }
}

@Module({ controllers: [SkillChecksController], providers: [SkillChecksService] })
export class SkillChecksModule {}
