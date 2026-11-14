#pragma once
#include <QLoggingCategory>
// The pinned MpvQt 1.2.1 uses the Qt 6.9 spelling for a translation-unit-local
// logging category. Qt 6.8 supports the same behavior with a static category.
// This build-only shim keeps every upstream source and license byte unchanged.
#ifndef Q_STATIC_LOGGING_CATEGORY
#define Q_STATIC_LOGGING_CATEGORY(name, ...) static Q_LOGGING_CATEGORY(name, __VA_ARGS__)
#endif
