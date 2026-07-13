import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { ImportModule } from '../import/import.module';

@Module({
  imports: [ImportModule],
  controllers: [CoursesController],
  providers: [CoursesService],
})
export class CoursesModule {}
