import { useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { File } from 'expo-file-system'
import { appendMobilePromptImages, uploadMobilePromptImages } from '@/mobile-detail-service'
import { colors } from '@/theme'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { MobileGlass } from './mobile-glass'
import { MobileSymbol } from './mobile-symbol'

type Attachment = { localUri: string; name: string; url: string }
type LocalImage = { uri: string; filename: string; mediaType: string; base64: string }

export function useMobileThreadAttachments(serviceUrl: string, backendId: string, value: string, onChange: (value: string) => void) {
  const [storedAttachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const attachments = storedAttachments.filter((attachment) => value.includes(attachment.url))

  async function add() {
    const remaining = 4 - attachments.length
    if (remaining <= 0) return
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      base64: true,
      mediaTypes: ['images'],
      quality: 1,
      selectionLimit: remaining,
    })
    if (result.canceled) return
    const accepted = result.assets.filter((asset) => asset.base64 && (!asset.fileSize || asset.fileSize <= 5 * 1024 * 1024)).slice(0, remaining)
    if (!accepted.length) return
    await upload(
      accepted.map((asset, index) => ({
        uri: asset.uri,
        filename: asset.fileName || `attachment-${attachments.length + index + 1}.${asset.mimeType?.split('/')[1] || 'jpg'}`,
        mediaType: asset.mimeType || 'image/jpeg',
        base64: asset.base64!,
      })),
    )
  }

  async function addUris(uris: string[]) {
    const remaining = 4 - attachments.length
    const files = uris
      .slice(0, remaining)
      .map((uri) => new File(uri))
      .filter((file) => file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024)
    await upload(
      await Promise.all(
        files.map(async (file, index) => ({
          uri: file.uri,
          filename: file.name || `pasted-image-${attachments.length + index + 1}`,
          mediaType: file.type,
          base64: await file.base64(),
        })),
      ),
    )
  }

  async function upload(images: LocalImage[]) {
    if (!images.length) return
    setError('')
    setUploading(true)
    try {
      const uploaded = await uploadMobilePromptImages(
        serviceUrl,
        backendId,
        images.map((image) => ({
          filename: image.filename,
          mediaType: image.mediaType,
          url: `data:${image.mediaType};base64,${image.base64}`,
        })),
      )
      setAttachments((current) => [
        ...current.filter((attachment) => value.includes(attachment.url)),
        ...uploaded.map((image, index) => ({ ...image, localUri: images[index].uri })),
      ])
      onChange(appendMobilePromptImages(value, uploaded))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not upload attachments')
    } finally {
      setUploading(false)
    }
  }

  function remove(attachment: Attachment) {
    setAttachments((current) => current.filter((item) => item.url !== attachment.url))
    onChange(
      value
        .replace(`![${attachment.name}](${attachment.url})`, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
  }

  return { attachments, uploading, error, add, addUris, remove }
}

export function MobileThreadAttachments({ controller }: { controller: ReturnType<typeof useMobileThreadAttachments> }) {
  return (
    <>
      {controller.attachments.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentList}>
          {controller.attachments.map((attachment) => (
            <View key={attachment.url} style={styles.attachmentPreview}>
              <Image source={{ uri: attachment.localUri }} style={styles.attachmentImage} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
                onPress={() => controller.remove(attachment)}
                style={styles.attachmentRemove}
              >
                <MobileSymbol name="xmark.circle.fill" fallback="×" color={colors.text} size={18} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {controller.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {controller.error}
        </Text>
      ) : null}
    </>
  )
}

export function MobileAttachButton({ controller }: { controller: ReturnType<typeof useMobileThreadAttachments> }) {
  const disabled = controller.uploading || controller.attachments.length >= 4
  return (
    <MobileGlass interactive style={styles.composerControlGlass}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Attach images"
        disabled={disabled}
        hitSlop={6}
        onPress={() => void controller.add()}
        style={({ pressed }) => [styles.composerIconButton, disabled && styles.disabled, pressed && styles.pressed]}
      >
        {controller.uploading ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <MobileSymbol name="paperclip" fallback="+" color={colors.accent} size={20} />
        )}
      </Pressable>
    </MobileGlass>
  )
}
