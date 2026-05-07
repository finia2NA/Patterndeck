import ExpoModulesCore
import UIKit

public class NativeDateTimePickerModule: Module {
  private var activePresenter: NativeDateTimePickerPresenter?

  public func definition() -> ModuleDefinition {
    Name("NativeDateTimePicker")

    AsyncFunction("present") { (options: [String: Any], promise: Promise) in
      DispatchQueue.main.async {
        if self.activePresenter != nil {
          promise.reject("ERR_PICKER_ALREADY_PRESENTED", "A date/time picker is already presented.")
          return
        }

        guard let presentingViewController = UIApplication.shared.pdTopViewController() else {
          promise.reject("ERR_NO_VIEW_CONTROLLER", "Could not find a view controller to present from.")
          return
        }

        guard let modeValue = options["mode"] as? String,
              let mode = NativeDateTimePickerMode(rawValue: modeValue),
              let value = options["value"] as? String,
              let date = ISO8601DateFormatter.pdPickerFormatter.date(from: value) else {
          promise.reject("ERR_INVALID_OPTIONS", "Invalid date/time picker options.")
          return
        }

        let title = options["title"] as? String ?? ""
        let cancelText = options["cancelText"] as? String ?? "Cancel"
        let confirmText = options["confirmText"] as? String ?? "Done"
        let is24Hour = options["is24Hour"] as? Bool ?? true
        let minuteInterval = options["minuteInterval"] as? Int ?? 1
        let accentColor = (options["accentColor"] as? String).flatMap(UIColor.pdFromHex)
        let resetText = options["resetText"] as? String
        let resetTextColor = (options["resetTextColor"] as? String).flatMap(UIColor.pdFromHex)

        let presenter = NativeDateTimePickerPresenter(
          mode: mode,
          date: date,
          title: title,
          cancelText: cancelText,
          confirmText: confirmText,
          is24Hour: is24Hour,
          minuteInterval: minuteInterval,
          accentColor: accentColor,
          resetText: resetText,
          resetTextColor: resetTextColor
        ) { result in
          self.activePresenter = nil
          promise.resolve(result)
        }

        self.activePresenter = presenter
        presenter.present(from: presentingViewController)
      }
    }
  }
}

private enum NativeDateTimePickerMode: String {
  case date
  case time
}

private final class NativeDateTimePickerPresenter: NSObject, UIAdaptivePresentationControllerDelegate {
  private let viewController: NativeDateTimePickerViewController
  private let completion: ([String: Any]) -> Void
  private var didComplete = false

  init(
    mode: NativeDateTimePickerMode,
    date: Date,
    title: String,
    cancelText: String,
    confirmText: String,
    is24Hour: Bool,
    minuteInterval: Int,
    accentColor: UIColor?,
    resetText: String?,
    resetTextColor: UIColor?,
    completion: @escaping ([String: Any]) -> Void
  ) {
    self.completion = completion
    self.viewController = NativeDateTimePickerViewController(
      mode: mode,
      date: date,
      title: title,
      cancelText: cancelText,
      confirmText: confirmText,
      is24Hour: is24Hour,
      minuteInterval: minuteInterval,
      accentColor: accentColor,
      resetText: resetText,
      resetTextColor: resetTextColor
    )
    super.init()
    viewController.onCancel = { [weak self] in self?.finish(action: "cancelled", date: nil) }
    viewController.onConfirm = { [weak self] date in self?.finish(action: "confirmed", date: date) }
    viewController.onReset = { [weak self] in self?.finish(action: "reset", date: nil) }
  }

  func present(from presentingViewController: UIViewController) {
    viewController.modalPresentationStyle = .pageSheet
    viewController.presentationController?.delegate = self
    if let sheet = viewController.sheetPresentationController {
      if #available(iOS 16.0, *) {
        let height: CGFloat = viewController.pickerMode == .date ? 540 : 360
        sheet.detents = [
          .custom(identifier: .init("patterndeckPicker")) { context in
            min(height, context.maximumDetentValue)
          }
        ]
      } else {
        sheet.detents = [.medium()]
      }
      sheet.prefersGrabberVisible = true
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
      sheet.preferredCornerRadius = 28
    }
    presentingViewController.present(viewController, animated: true)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finish(action: "dismissed", date: nil, shouldDismiss: false)
  }

  private func finish(action: String, date: Date?, shouldDismiss: Bool = true) {
    guard !didComplete else { return }
    didComplete = true

    let result: [String: Any]
    if let date {
      result = [
        "action": action,
        "value": ISO8601DateFormatter.pdPickerFormatter.string(from: date)
      ]
    } else {
      result = ["action": action]
    }

    if shouldDismiss {
      viewController.dismiss(animated: true) { [completion] in completion(result) }
    } else {
      completion(result)
    }
  }
}

private final class NativeDateTimePickerViewController: UIViewController {
  let pickerMode: NativeDateTimePickerMode
  var onCancel: (() -> Void)?
  var onConfirm: ((Date) -> Void)?
  var onReset: (() -> Void)?

  private let initialDate: Date
  private let titleText: String
  private let cancelText: String
  private let confirmText: String
  private let is24Hour: Bool
  private let minuteInterval: Int
  private let accentColor: UIColor?
  private let resetText: String?
  private let resetTextColor: UIColor?
  private let picker = UIDatePicker()

  init(
    mode: NativeDateTimePickerMode,
    date: Date,
    title: String,
    cancelText: String,
    confirmText: String,
    is24Hour: Bool,
    minuteInterval: Int,
    accentColor: UIColor?,
    resetText: String?,
    resetTextColor: UIColor?
  ) {
    self.pickerMode = mode
    self.initialDate = date
    self.titleText = title
    self.cancelText = cancelText
    self.confirmText = confirmText
    self.is24Hour = is24Hour
    self.minuteInterval = min(max(minuteInterval, 1), 30)
    self.accentColor = accentColor
    self.resetText = resetText
    self.resetTextColor = resetTextColor
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    configurePicker()
    buildLayout()
  }

  private func configurePicker() {
    picker.date = initialDate
    picker.tintColor = accentColor
    picker.minuteInterval = minuteInterval
    picker.preferredDatePickerStyle = pickerMode == .date ? .inline : .wheels
    picker.datePickerMode = pickerMode == .date ? .date : .time

    if pickerMode == .time && is24Hour {
      picker.locale = Locale(identifier: "en_GB")
    }
  }

  private func buildLayout() {
    let header = UIView()
    header.translatesAutoresizingMaskIntoConstraints = false

    let titleLabel = UILabel()
    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    titleLabel.text = titleText
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.textAlignment = .center
    titleLabel.numberOfLines = 1

    let cancelButton = UIButton(type: .system)
    cancelButton.translatesAutoresizingMaskIntoConstraints = false
    cancelButton.setTitle(cancelText, for: .normal)
    cancelButton.titleLabel?.font = .preferredFont(forTextStyle: .body)
    cancelButton.addTarget(self, action: #selector(cancelPressed), for: .touchUpInside)

    let confirmButton = UIButton(type: .system)
    confirmButton.translatesAutoresizingMaskIntoConstraints = false
    confirmButton.setTitle(confirmText, for: .normal)
    confirmButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    confirmButton.addTarget(self, action: #selector(confirmPressed), for: .touchUpInside)
    if let accentColor {
      cancelButton.tintColor = accentColor
      confirmButton.tintColor = accentColor
    }

    picker.translatesAutoresizingMaskIntoConstraints = false
    let resetButton = makeResetButton()

    view.addSubview(header)
    header.addSubview(cancelButton)
    header.addSubview(titleLabel)
    header.addSubview(confirmButton)
    view.addSubview(picker)
    if let resetButton {
      view.addSubview(resetButton)
    }

    let pickerHeight: CGFloat = pickerMode == .date ? 420 : 220
    let resetTopAnchor = resetButton?.topAnchor.constraint(equalTo: picker.bottomAnchor, constant: 8)
    let resetCenterAnchor = resetButton?.centerXAnchor.constraint(equalTo: view.centerXAnchor)
    let resetHeightAnchor = resetButton?.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)

    var constraints = [
      header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      header.heightAnchor.constraint(equalToConstant: 56),

      cancelButton.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 20),
      cancelButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
      cancelButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 64),

      confirmButton.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -20),
      confirmButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
      confirmButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 64),

      titleLabel.leadingAnchor.constraint(greaterThanOrEqualTo: cancelButton.trailingAnchor, constant: 12),
      titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: confirmButton.leadingAnchor, constant: -12),
      titleLabel.centerXAnchor.constraint(equalTo: header.centerXAnchor),
      titleLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),

      picker.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
      picker.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      picker.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      picker.heightAnchor.constraint(equalToConstant: pickerHeight)
    ]

    if let resetTopAnchor, let resetCenterAnchor, let resetHeightAnchor {
      constraints.append(contentsOf: [resetTopAnchor, resetCenterAnchor, resetHeightAnchor])
    }

    NSLayoutConstraint.activate(constraints)
  }

  private func makeResetButton() -> UIButton? {
    guard pickerMode == .date, let resetText, !resetText.isEmpty else {
      return nil
    }

    let button = UIButton(type: .system)
    button.translatesAutoresizingMaskIntoConstraints = false
    button.setTitle(resetText, for: .normal)
    button.titleLabel?.font = .preferredFont(forTextStyle: .body)
    button.tintColor = resetTextColor ?? .systemRed
    button.addTarget(self, action: #selector(resetPressed), for: .touchUpInside)
    return button
  }

  @objc private func cancelPressed() {
    onCancel?()
  }

  @objc private func confirmPressed() {
    onConfirm?(picker.date)
  }

  @objc private func resetPressed() {
    onReset?()
  }
}

private extension ISO8601DateFormatter {
  static let pdPickerFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

private extension UIColor {
  static func pdFromHex(_ hex: String) -> UIColor? {
    var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if cleaned.hasPrefix("#") {
      cleaned.removeFirst()
    }

    guard cleaned.count == 6 || cleaned.count == 8,
          let value = UInt64(cleaned, radix: 16) else {
      return nil
    }

    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat
    let alpha: CGFloat

    if cleaned.count == 8 {
      red = CGFloat((value & 0xFF000000) >> 24) / 255
      green = CGFloat((value & 0x00FF0000) >> 16) / 255
      blue = CGFloat((value & 0x0000FF00) >> 8) / 255
      alpha = CGFloat(value & 0x000000FF) / 255
    } else {
      red = CGFloat((value & 0xFF0000) >> 16) / 255
      green = CGFloat((value & 0x00FF00) >> 8) / 255
      blue = CGFloat(value & 0x0000FF) / 255
      alpha = 1
    }

    return UIColor(red: red, green: green, blue: blue, alpha: alpha)
  }
}

private extension UIApplication {
  func pdTopViewController(
    base: UIViewController? = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }?
      .rootViewController
  ) -> UIViewController? {
    if let navigationController = base as? UINavigationController {
      return pdTopViewController(base: navigationController.visibleViewController)
    }

    if let tabBarController = base as? UITabBarController,
       let selectedViewController = tabBarController.selectedViewController {
      return pdTopViewController(base: selectedViewController)
    }

    if let presentedViewController = base?.presentedViewController {
      return pdTopViewController(base: presentedViewController)
    }

    return base
  }
}
