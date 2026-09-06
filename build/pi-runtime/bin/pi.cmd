@echo off
setlocal

if "%PCC_AGENT_PI_RUNTIME_HOST%"=="" (
  echo PccAgent bundled Pi runtime is not configured. 1>&2
  exit /b 78
)
if "%PCC_AGENT_PI_ENTRY%"=="" (
  echo PccAgent bundled Pi runtime is not configured. 1>&2
  exit /b 78
)

set "ELECTRON_RUN_AS_NODE=1"
if "%PCC_AGENT_PI_CONTEXT_EXTENSION%"=="" (
  echo PccAgent bundled Pi context bridge is not configured. 1>&2
  exit /b 78
)
set "PCC_AGENT_PI_LAUNCH_TARGET=%PCC_AGENT_PI_ENTRY%"
if not "%PCC_AGENT_PI_PACKAGE_CONFIG%"=="" (
  if "%PCC_AGENT_PI_PACKAGE_BOOTSTRAP%"=="" (
    echo PccAgent bundled Pi package launcher is unavailable. 1>&2
    exit /b 78
  )
  if not exist "%PCC_AGENT_PI_PACKAGE_BOOTSTRAP%" (
    echo PccAgent bundled Pi package launcher is unavailable. 1>&2
    exit /b 78
  )
  set "PCC_AGENT_PI_LAUNCH_TARGET=%PCC_AGENT_PI_PACKAGE_BOOTSTRAP%"
)
if not "%PCC_AGENT_PI_MCP_EXTENSION%"=="" (
  if "%PCC_AGENT_PI_MCP_CONFIG%"=="" (
    echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
    exit /b 78
  )
  if "%PCC_AGENT_PI_MCP_ADAPTER%"=="" (
    echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
    exit /b 78
  )
  if not "%PCC_AGENT_PI_PROJECT_SKILLS%"=="" (
    if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
      call :run %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%" --skill "%PCC_AGENT_PI_PROJECT_SKILLS%" --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%" --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
      exit /b %ERRORLEVEL%
    )
    call :run %* --skill "%PCC_AGENT_PI_PROJECT_SKILLS%" --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%" --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
    exit /b %ERRORLEVEL%
  )
  if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
    call :run %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%" --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%" --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
    exit /b %ERRORLEVEL%
  )
  call :run %* --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%" --extension "%PCC_AGENT_PI_MCP_EXTENSION%"
  exit /b %ERRORLEVEL%
)
if not "%PCC_AGENT_PI_MCP_CONFIG%"=="" (
  echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
  exit /b 78
)
if not "%PCC_AGENT_PI_MCP_ADAPTER%"=="" (
  echo PccAgent bundled Pi MCP runtime is incomplete. 1>&2
  exit /b 78
)
if not "%PCC_AGENT_PI_PROJECT_SKILLS%"=="" (
  if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
    call :run %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%" --skill "%PCC_AGENT_PI_PROJECT_SKILLS%" --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%"
    exit /b %ERRORLEVEL%
  )
  call :run %* --skill "%PCC_AGENT_PI_PROJECT_SKILLS%" --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%"
  exit /b %ERRORLEVEL%
)
if not "%PCC_AGENT_PI_GLOBAL_SKILLS%"=="" (
  call :run %* --skill "%PCC_AGENT_PI_GLOBAL_SKILLS%" --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%"
  exit /b %ERRORLEVEL%
)
call :run %* --extension "%PCC_AGENT_PI_CONTEXT_EXTENSION%"
exit /b %ERRORLEVEL%

:run
"%PCC_AGENT_PI_RUNTIME_HOST%" "%PCC_AGENT_PI_LAUNCH_TARGET%" %*
exit /b %ERRORLEVEL%
