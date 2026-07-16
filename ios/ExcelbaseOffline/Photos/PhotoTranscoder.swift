import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

public struct TranscodedPhoto: Hashable, Sendable {
    public let url: URL
    public let sha256: String
    public let pixelWidth: Int
    public let pixelHeight: Int
}

public struct PhotoTranscoder: Sendable {
    public let maximumPixelDimension: Int
    public let compressionQuality: Double

    public init(maximumPixelDimension: Int = 2_400, compressionQuality: Double = 0.88) {
        self.maximumPixelDimension = maximumPixelDimension
        self.compressionQuality = compressionQuality
    }

    public func transcode(source: URL, destination: URL) throws -> TranscodedPhoto {
        guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil) else {
            throw PhotoError.unreadableImage(source.lastPathComponent)
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixelDimension,
            kCGImageSourceShouldCacheImmediately: false
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, options as CFDictionary) else {
            throw PhotoError.unreadableImage(source.lastPathComponent)
        }
        guard let destinationRef = CGImageDestinationCreateWithURL(
            destination as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else { throw PhotoError.cannotCreateDestination }
        CGImageDestinationAddImage(
            destinationRef,
            image,
            [kCGImageDestinationLossyCompressionQuality: compressionQuality] as CFDictionary
        )
        guard CGImageDestinationFinalize(destinationRef) else { throw PhotoError.cannotCreateDestination }
        try ProtectedContainer.protectFile(at: destination)
        let data = try Data(contentsOf: destination, options: .mappedIfSafe)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return TranscodedPhoto(
            url: destination,
            sha256: digest,
            pixelWidth: image.width,
            pixelHeight: image.height
        )
    }
}

public enum PhotoError: LocalizedError, Sendable {
    case unreadableImage(String)
    case cannotCreateDestination

    public var errorDescription: String? {
        switch self {
        case let .unreadableImage(name): "Fotoğraf okunamadı: \(name)."
        case .cannotCreateDestination: "Fotoğraf kasasında hedef oluşturulamadı."
        }
    }
}
