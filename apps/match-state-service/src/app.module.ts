import { Module } from "@nestjs/common";
import { StateModule } from "./state/state.module";

@Module({
  imports: [StateModule],
})
export class AppModule {}
