import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Icon, IconName } from './Icon';

interface TabItem {
  icon?: IconName;
  customIcon?: React.ReactNode;
  label: string;
  onPress: () => void;
  active?: boolean;
}

interface FloatingTabBarProps {
  tabs: TabItem[];
}

export const FloatingTabBar: React.FC<FloatingTabBarProps> = ({ tabs }) => {
  return (
    <View style={styles.container}>
      <View style={styles.island}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.tab, tab.active && styles.tabActive]}
            onPress={tab.onPress}
            activeOpacity={0.7}
          >
            {tab.customIcon ? (
              tab.customIcon
            ) : tab.icon ? (
              <Icon 
                name={tab.icon} 
                size={22} 
                color={tab.active ? '#ffffff' : '#888888'} 
              />
            ) : null}
            <Text style={[styles.label, tab.active && styles.labelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  island: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 20,
    minWidth: 60,
    gap: 4,
  },
  tabActive: {
    backgroundColor: '#7c3aed',
  },
  label: {
    fontSize: 9,
    color: '#888888',
    fontWeight: '600',
    textAlign: 'center',
  },
  labelActive: {
    color: '#ffffff',
  },
});
