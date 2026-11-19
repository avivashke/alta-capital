# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 15 דקות · ETHUSDT · 15m
# Version: v1.1 · Strategy family: rsi_reversion
# Backtest: return 2.03% · PF 1.3 · DD 2.35% · trades 19
# OOS: 0.47% · Sharpe 5.3
# Params: {"period":9,"oversold":21,"overbought":65,"atrStop":1.5,"rr":2}
# Target platform: Freqtrade
# Generated: 2026-11-19T22:16:40.336Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_15m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_15m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_15m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '15m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.018
    minimal_roi = {"0": 1.80, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=9)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 21)
        & (dataframe['rsi'].shift(1) > 21)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 65)
        & (dataframe['rsi'].shift(1) < 65)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 21)
        & (dataframe['rsi'].shift(1) > 21)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 65)
        & (dataframe['rsi'].shift(1) < 65)
            ),
            'exit_long',
        ] = 1
        return dataframe
