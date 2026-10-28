import { useEffect, useState } from 'react';
import {
  FluentProvider, Menu, MenuItemSwitch, MenuList, MenuPopover, MenuTrigger, Button,
  webDarkTheme, webLightTheme, tokens,
} from '@fluentui/react-components';
import { SettingsRegular } from '@fluentui/react-icons';
import App from './App';

const KEY = 'theme';

export default function Root() {
  const [dark, setDark] = useState(() => localStorage.getItem(KEY) !== 'light');
  useEffect(() => {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
    document.body.style.backgroundColor = dark ? '#292929' : '#ffffff';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  return (
    <FluentProvider
      theme={dark ? webDarkTheme : webLightTheme}
      style={{ height: '100%', backgroundColor: tokens.colorNeutralBackground1 }}
    >
      <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 1000 }}>
        <Menu checkedValues={{ theme: dark ? ['dark'] : [] }} onCheckedValueChange={(_, d) => setDark(d.checkedItems.includes('dark'))}>
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="subtle" icon={<SettingsRegular />} aria-label="Settings" />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItemSwitch name="theme" value="dark">Dark mode</MenuItemSwitch>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      <App />
    </FluentProvider>
  );
}
