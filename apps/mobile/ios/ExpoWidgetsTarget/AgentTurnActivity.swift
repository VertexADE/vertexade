import WidgetKit
import SwiftUI
internal import ExpoWidgets

struct AgentTurnActivity: Widget {
  let name: String = "AgentTurnActivity"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: name, provider: WidgetsTimelineProvider(name: name)) { entry in
      WidgetsEntryView(entry: entry)
    }
    .configurationDisplayName("Agent turn")
    .description("Shows the current VertexADE agent turn.")
    .supportedFamilies([.systemSmall])
  }
}