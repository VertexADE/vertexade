import 'react-native'

declare module 'react-native' {
  interface TextInputProps {
    /** React Native 0.86 native drag-and-drop type filter. */
    experimental_acceptDragAndDropTypes?: ReadonlyArray<string>
  }
}
