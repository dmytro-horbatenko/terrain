import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { CourseUpdatesService } from './course-updates.service';

@Module({
  controllers: [CoursesController],
  providers: [CoursesService, CourseUpdatesService],
})
export class CoursesModule {}
