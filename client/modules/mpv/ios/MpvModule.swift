import ExpoModulesCore

public class MpvModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Mpv")

    Function("isAvailable") { () -> Bool in
      MpvView.isAvailable
    }

    View(MpvView.self) {
      Events("onMpvEvent")

      Prop("source") { (view: MpvView, source: MpvSource?) in view.source = source }
      Prop("paused") { (view: MpvView, paused: Bool) in view.paused = paused }
      Prop("speed") { (view: MpvView, speed: Double) in view.speed = speed }
      Prop("audioTrack") { (view: MpvView, track: String) in view.audioTrack = track }
      Prop("subtitleTrack") { (view: MpvView, track: String) in view.subtitleTrack = track }
      Prop("resizeMode") { (view: MpvView, mode: String) in view.resizeMode = mode }
      Prop("decode") { (view: MpvView, decode: String) in view.decode = decode }

      OnViewDidUpdateProps { (view: MpvView) in
        view.applyProps()
      }

      AsyncFunction("seek") { (view: MpvView, ms: Double) in
        view.seek(ms)
      }.runOnQueue(.main)
    }
  }
}

struct MpvSubtitle: Record {
  @Field var url: String = ""
  @Field var name: String = ""
  @Field var lang: String?
}

struct MpvSource: Record {
  @Field var url: String = ""
  @Field var headers: [String: String] = [:]
  @Field var title: String?
  /// Seconds.
  @Field var startPosition: Double = 0
  @Field var format: String?
  @Field var subtitles: [MpvSubtitle] = []
}
