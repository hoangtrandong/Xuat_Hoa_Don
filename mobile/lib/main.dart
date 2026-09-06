import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_store.dart';
import 'screens/app_shell.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const DmsSalesApp());
}

class DmsSalesApp extends StatelessWidget {
  const DmsSalesApp({super.key});

  @override
  Widget build(BuildContext context) {
    return AppStoreScope(
      store: AppStore.instance,
      child: MaterialApp(
        title: 'DMS Sales',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: const AppShell(),
      ),
    );
  }
}
