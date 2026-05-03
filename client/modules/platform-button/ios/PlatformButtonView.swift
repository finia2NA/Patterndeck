import ExpoModulesCore
import UIKit

class PlatformButtonView: ExpoView {
  let onButtonPress = EventDispatcher()

  private var text: String?
  private var symbolName: String?
  private var variant = "plain"
  private var isButtonDisabled = false
  private var foregroundColor: UIColor?
  private var buttonBackgroundColor: UIColor?
  private var disabledForegroundColor: UIColor?
  private var fontSize: CGFloat = 17
  private var fontWeight = "regular"
  private var horizontalPadding: CGFloat = 8
  private var verticalPadding: CGFloat = 8
  private var iconPointSize: CGFloat = 18
  private var cornerRadius: CGFloat?
  private var contentAlignment = "center"
  private var explicitAccessibilityLabel: String?
  private var confirmationTitle: String?
  private var confirmationMessage: String?
  private var confirmationActionText: String?
  private var confirmationDestructive = false

  private lazy var button: UIButton = {
    let btn = UIButton(type: .system)
    btn.translatesAutoresizingMaskIntoConstraints = false
    btn.addTarget(self, action: #selector(handlePress), for: .touchUpInside)
    return btn
  }()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    addSubview(button)
    NSLayoutConstraint.activate([
      button.topAnchor.constraint(equalTo: topAnchor),
      button.leadingAnchor.constraint(equalTo: leadingAnchor),
      button.trailingAnchor.constraint(equalTo: trailingAnchor),
      button.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
    refreshConfiguration()
  }

  override var intrinsicContentSize: CGSize {
    button.intrinsicContentSize
  }

  func updateText(_ text: String?) {
    self.text = text
    refreshConfiguration()
  }

  func updateSymbolName(_ symbolName: String?) {
    self.symbolName = symbolName
    refreshConfiguration()
  }

  func updateVariant(_ variant: String?) {
    self.variant = variant ?? "plain"
    refreshConfiguration()
  }

  func updateDisabled(_ disabled: Bool) {
    isButtonDisabled = disabled
    refreshConfiguration()
  }

  func updateForegroundColor(_ hex: String?) {
    foregroundColor = UIColor(hex: hex)
    refreshConfiguration()
  }

  func updateBackgroundColor(_ hex: String?) {
    buttonBackgroundColor = UIColor(hex: hex)
    refreshConfiguration()
  }

  func updateDisabledForegroundColor(_ hex: String?) {
    disabledForegroundColor = UIColor(hex: hex)
    refreshConfiguration()
  }

  func updateFontSize(_ fontSize: Double?) {
    self.fontSize = CGFloat(fontSize ?? 17)
    refreshConfiguration()
  }

  func updateFontWeight(_ fontWeight: String?) {
    self.fontWeight = fontWeight ?? "regular"
    refreshConfiguration()
  }

  func updateHorizontalPadding(_ padding: Double?) {
    horizontalPadding = CGFloat(padding ?? 8)
    refreshConfiguration()
  }

  func updateVerticalPadding(_ padding: Double?) {
    verticalPadding = CGFloat(padding ?? 8)
    refreshConfiguration()
  }

  func updateIconPointSize(_ iconPointSize: Double?) {
    self.iconPointSize = CGFloat(iconPointSize ?? 18)
    refreshConfiguration()
  }

  func updateCornerRadius(_ cornerRadius: Double?) {
    self.cornerRadius = cornerRadius.map { CGFloat($0) }
    refreshConfiguration()
  }

  func updateContentAlignment(_ alignment: String?) {
    contentAlignment = alignment ?? "center"
    refreshConfiguration()
  }

  func updateAccessibilityLabel(_ label: String?) {
    explicitAccessibilityLabel = label
    refreshConfiguration()
  }

  func updateConfirmationTitle(_ title: String?) {
    confirmationTitle = title
    refreshConfiguration()
  }

  func updateConfirmationMessage(_ message: String?) {
    confirmationMessage = message
    refreshConfiguration()
  }

  func updateConfirmationActionText(_ actionText: String?) {
    confirmationActionText = actionText
    refreshConfiguration()
  }

  func updateConfirmationDestructive(_ destructive: Bool) {
    confirmationDestructive = destructive
    refreshConfiguration()
  }

  @objc private func handlePress() {
    guard !isButtonDisabled else { return }
    if shouldPresentConfirmation { return }  // UIKit presents the menu
    onButtonPress()
  }

  private var shouldPresentConfirmation: Bool {
    guard let actionText = confirmationActionText?.trimmingCharacters(in: .whitespacesAndNewlines), !actionText.isEmpty else {
      return false
    }
    return !(confirmationTitle?.isEmpty ?? true) || !(confirmationMessage?.isEmpty ?? true)
  }

  private func makeConfirmationMenu() -> UIMenu {
    let actionText = confirmationActionText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let action = UIAction(
      title: actionText,
      image: confirmationDestructive ? UIImage(systemName: "trash") : nil,
      attributes: confirmationDestructive ? .destructive : []
    ) { [weak self] _ in
      self?.onButtonPress()
    }
    if #available(iOS 16.0, *) {
      return UIMenu(
        title: confirmationTitle ?? "",
        subtitle: confirmationMessage,
        children: [action]
      )
    }
    return UIMenu(title: confirmationTitle ?? "", children: [action])
  }

  private func refreshConfiguration() {
    var config = makeConfiguration()

    let resolvedForegroundColor = isButtonDisabled
      ? (disabledForegroundColor ?? UIColor.secondaryLabel)
      : (foregroundColor ?? tintColor ?? UIColor.tintColor)

    if let text, !text.isEmpty {
      var attr = AttributedString(text)
      attr.font = UIFont.systemFont(ofSize: fontSize, weight: resolvedFontWeight)
      attr.foregroundColor = resolvedForegroundColor
      config.attributedTitle = attr
    } else {
      config.title = nil
      config.attributedTitle = nil
    }

    if let symbolName, !symbolName.isEmpty {
      config.image = UIImage(
        systemName: symbolName,
        withConfiguration: UIImage.SymbolConfiguration(pointSize: iconPointSize, weight: .semibold)
      )?.withTintColor(resolvedForegroundColor, renderingMode: .alwaysOriginal)
      config.imagePadding = text?.isEmpty == false ? 6 : 0
    } else {
      config.image = nil
    }

    config.baseForegroundColor = resolvedForegroundColor
    config.imageColorTransformer = UIConfigurationColorTransformer { _ in
      resolvedForegroundColor
    }

    if let buttonBackgroundColor {
      config.baseBackgroundColor = buttonBackgroundColor
      config.background.backgroundColor = buttonBackgroundColor
    }

    config.contentInsets = NSDirectionalEdgeInsets(
      top: verticalPadding,
      leading: horizontalPadding,
      bottom: verticalPadding,
      trailing: horizontalPadding
    )

    if let cornerRadius {
      config.background.cornerRadius = cornerRadius
    } else if symbolName != nil && text == nil {
      config.cornerStyle = .capsule
    }

    button.configuration = config
    if shouldPresentConfirmation {
      button.menu = makeConfirmationMenu()
      button.showsMenuAsPrimaryAction = true
    } else {
      button.menu = nil
      button.showsMenuAsPrimaryAction = false
    }
    button.tintColor = resolvedForegroundColor
    button.isEnabled = !isButtonDisabled
    button.accessibilityLabel = explicitAccessibilityLabel ?? text
    button.contentHorizontalAlignment = resolvedContentAlignment
    invalidateIntrinsicContentSize()
  }

  private func makeConfiguration() -> UIButton.Configuration {
    if #available(iOS 26.0, *) {
      switch variant {
      case "glass":
        return .glass()
      case "prominentGlass":
        return .prominentGlass()
      case "clearGlass":
        return .clearGlass()
      case "prominentClearGlass":
        return .prominentClearGlass()
      default:
        break
      }
    }

    switch variant {
    case "filled":
      return .filled()
    case "gray":
      return .gray()
    case "tinted":
      return .tinted()
    case "prominentGlass", "prominentClearGlass":
      return .filled()
    case "glass", "clearGlass":
      return .tinted()
    default:
      return .plain()
    }
  }

  private var resolvedFontWeight: UIFont.Weight {
    switch fontWeight {
    case "bold":
      return .bold
    case "semibold":
      return .semibold
    case "medium":
      return .medium
    default:
      return .regular
    }
  }

  private var resolvedContentAlignment: UIControl.ContentHorizontalAlignment {
    switch contentAlignment {
    case "left":
      return .leading
    case "right":
      return .trailing
    default:
      return .center
    }
  }
}

private extension UIColor {
  convenience init?(hex: String?) {
    guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
      return nil
    }
    if s.hasPrefix("#") { s = String(s.dropFirst()) }
    var rgb: UInt64 = 0
    guard s.count == 6, Scanner(string: s).scanHexInt64(&rgb) else { return nil }
    self.init(
      red: CGFloat((rgb & 0xFF0000) >> 16) / 255,
      green: CGFloat((rgb & 0x00FF00) >> 8) / 255,
      blue: CGFloat(rgb & 0x0000FF) / 255,
      alpha: 1
    )
  }
}
