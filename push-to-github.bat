@echo off
echo ========================================
echo  BACKEND CODE PUSH TO GITHUB
echo ========================================
echo.

cd /d "%~dp0"

echo Step 1: Checking Git Status...
git status

echo.
echo Step 2: Remote URL
git remote get-url origin

echo.
echo Step 3: Pushing to GitHub...
echo NOTE: GitHub will ask for username and password/token
echo Username: bhushanjadhav229
echo Password: Use your Personal Access Token (not password)
echo.

git push -u origin main

echo.
if %ERRORLEVEL% EQU 0 (
    echo ========================================
    echo  SUCCESS! Code pushed to GitHub
    echo ========================================
) else (
    echo ========================================
    echo  FAILED! Please check credentials
    echo ========================================
    echo.
    echo Solutions:
    echo 1. Use GitHub Desktop ^(Easiest^)
    echo 2. Generate Personal Access Token from GitHub
    echo 3. Check internet connection
)

pause


