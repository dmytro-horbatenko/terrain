import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TopicsService } from './topics.service';
import { CreateAppEventDto, CreateTopicDto, AddPrerequisiteDto, UpdateTopicDto } from './dto';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('topics')
export class TopicsController {
  constructor(private service: TopicsService) {}
  @Post() create(@CurrentUser() userId: string, @Body() dto: CreateTopicDto) {
    return this.service.create(userId, dto);
  }
  @Get() findAll(@CurrentUser() userId: string) {
    return this.service.findAll(userId);
  }
  @Get(':id') findOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.getDetail(userId, id);
  }
  @Patch(':id') update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTopicDto,
  ) {
    return this.service.update(userId, id, dto);
  }
  @Delete(':id') remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
  @Post(':id/app-events') addAppEvent(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateAppEventDto,
  ) {
    return this.service.addAppEvent(userId, id, dto);
  }
  @Post(':id/prerequisites') addPrerequisite(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: AddPrerequisiteDto,
  ) {
    return this.service.addPrerequisite(userId, id, dto.prerequisiteId);
  }
  @Delete(':id/prerequisites/:prerequisiteId') removePrerequisite(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('prerequisiteId') prerequisiteId: string,
  ) {
    return this.service.removePrerequisite(userId, id, prerequisiteId);
  }
}
