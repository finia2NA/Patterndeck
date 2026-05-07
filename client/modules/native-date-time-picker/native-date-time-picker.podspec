require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'native-date-time-picker'
  s.version        = package['version']
  s.summary        = 'Native iOS sheet date and time picker'
  s.homepage       = 'https://github.com/example'
  s.license        = { :type => 'MIT' }
  s.author         = 'PatternDeck'
  s.platform       = :ios, '15.1'
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.swift_version  = '5.4'
end
