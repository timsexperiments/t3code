sdk_version = Gem::Version.new(Pod::Executable.execute_command('xcrun', ['--sdk', 'iphoneos', '--show-sdk-version']).strip)

Pod::Spec.new do |s|
  s.name           = 'T3NativeControls'
  s.version        = '1.0.0'
  s.summary        = 'Native UIKit controls for T3 Code mobile.'
  s.description    = 'UIKit-backed controls that match native iOS navigation chrome.'
  s.author         = 'T3 Tools'
  s.homepage       = 'https://t3tools.com'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => "$(inherited) #{sdk_version >= Gem::Version.new('27.1') ? 'T3_IOS_27_1_SDK' : ''}",
  }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
