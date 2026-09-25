import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApplyCourseUpdateDto, SetCourseDisabledDto } from './dto';
import { CourseUpdatesService } from './course-updates.service';

@Controller('courses')
export class CoursesController {
  constructor(
    private service: CoursesService,
    private updates: CourseUpdatesService,
  ) {}

  @Get(':id/update-preview')
  previewUpdate(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.updates.preview(userId, id);
  }

  @Post(':id/update')
  applyUpdate(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: ApplyCourseUpdateDto,
  ) {
    return this.updates.apply(userId, id, dto.expectedFingerprint);
  }

  @Get()
  list(@CurrentUser() userId: string) {
    return this.service.list(userId);
  }

  @Post(':id/import')
  import(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.importCourse(userId, id);
  }

  @Patch(':id/disabled')
  setDisabled(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetCourseDisabledDto,
  ) {
    return this.service.setDisabled(userId, id, dto.disabled);
  }
}
